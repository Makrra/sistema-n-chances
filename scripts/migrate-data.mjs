#!/usr/bin/env node
// Migração de dados: Supabase (Postgres) -> Cloudflare D1 (SQLite).
//
// Uso:
//   node scripts/migrate-data.mjs <pasta-com-csvs> > data.sql
//   npx wrangler d1 execute n-chances-db-staging --env staging --remote --file=data.sql
//
// A pasta de entrada deve conter, exportados do Supabase (SQL Editor ->
// rodar `select * from <tabela>` -> "Download CSV"), um arquivo por tabela:
//   usuarios.csv  boloes.csv  participacoes.csv  extrato.csv  saques.csv
//
// O script gera um único .sql com:
//   1. DELETE FROM em todas as tabelas (ordem reversa de FK) — torna a
//      reimportação idempotente (pode rodar de novo sem duplicar).
//   2. INSERT INTO para cada tabela (ordem: usuarios -> boloes ->
//      participacoes -> extrato -> saques, respeitando as FKs do D1, que
//      ficam sempre ligadas e não podem ser desativadas durante import).
//
// Conversões de tipo (ver worker/migrations/0001_init.sql para o porquê):
//   - dinheiro (NUMERIC reais) -> INTEGER centavos
//   - cotas (NUMERIC, aceita 0.5) -> INTEGER cotas_meias (1 cota = 2)
//   - timestamps (TIMESTAMPTZ) -> TEXT ISO 8601 (com 'T' e 'Z')
//
// Não escreve no D1 diretamente — só gera o .sql. Rodar o `wrangler d1
// execute` é um passo manual separado, de propósito (dá pra revisar o SQL
// gerado antes de tocar no banco real).

import fs from 'node:fs';
import path from 'node:path';

const inputDir = process.argv[2];
if (!inputDir) {
  console.error('Uso: node scripts/migrate-data.mjs <pasta-com-csvs> > data.sql');
  process.exit(1);
}

// ---------- CSV parsing (RFC4180: aspas, vírgulas e quebras de linha dentro de campo) ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // normaliza quebras de linha
  text = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1)
    .filter(r => r.length === header.length && !(r.length === 1 && r[0] === ''))
    .map(r => Object.fromEntries(header.map((h, idx) => [h, r[idx]])));
}

function readTable(name) {
  const file = path.join(inputDir, `${name}.csv`);
  if (!fs.existsSync(file)) {
    console.error(`Aviso: ${file} não encontrado, pulando tabela '${name}' (fica vazia).`);
    return [];
  }
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

// ---------- helpers de conversão / SQL ----------
// O export CSV do Supabase grava célula vazia como o TEXTO LITERAL "null"
// (4 caracteres), não como célula vazia de verdade — precisa tratar como nulo.
const nullish = (v) => v === undefined || v === null || v === '' || (typeof v === 'string' && v.trim().toLowerCase() === 'null');

function sqlStr(v) {
  if (nullish(v)) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlNum(v) {
  if (nullish(v)) return 'NULL';
  const n = Number(v);
  if (Number.isNaN(n)) return 'NULL';
  return String(n);
}
function toCentavos(v) {
  if (nullish(v)) return 'NULL';
  return String(Math.round(parseFloat(v) * 100));
}
function toCotasMeias(v) {
  if (nullish(v)) return '0';
  return String(Math.round(parseFloat(v) * 2));
}
// Postgres exporta timestamptz como "2026-01-15 10:23:00.123456+00" — o
// `Date` do V8 não entende offset de 2 dígitos sem os minutos ("+00"), só
// "+00:00"/"Z". Troca o espaço por 'T' e completa o offset antes de parsear.
function normalizePgTimestamp(v) {
  let s = v.trim().replace(' ', 'T');
  s = s.replace(/([+-]\d{2})$/, '$1:00'); // "+00" -> "+00:00" (não mexe se já tiver ':' ou 'Z')
  return s;
}
function toIso(v) {
  if (nullish(v)) return 'NULL';
  const d = new Date(normalizePgTimestamp(v));
  if (Number.isNaN(d.getTime())) {
    console.error(`Aviso: timestamp inválido "${v}", gravando NULL.`);
    return 'NULL';
  }
  return sqlStr(d.toISOString());
}
// data_nascimento vem do export como DD/MM/AAAA (não é timestamp do Postgres,
// é um campo de data simples) — converte pra AAAA-MM-DD, mesmo padrão de data_sorteio.
function toDateBrParaIso(v) {
  if (nullish(v)) return 'NULL';
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) {
    console.error(`Aviso: data "${v}" fora do formato DD/MM/AAAA, gravando NULL.`);
    return 'NULL';
  }
  const [, dd, mm, yyyy] = m;
  return sqlStr(`${yyyy}-${mm}-${dd}`);
}
function insert(table, columns, rows) {
  if (!rows.length) return `-- (nenhuma linha em ${table})\n`;
  const lines = rows.map(vals => `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${vals.join(', ')});`);
  return lines.join('\n') + '\n';
}

// ---------- transformação por tabela ----------
function transformUsuarios(rows) {
  const cols = ['telefone', 'nome_completo', 'apelido', 'email', 'data_nascimento', 'saldo_centavos', 'criado_em'];
  const values = rows.map(r => [
    sqlStr(r.telefone), sqlStr(r.nome_completo), sqlStr(r.apelido), sqlStr(r.email),
    toDateBrParaIso(r.data_nascimento),
    '0', // saldo_centavos é recalculado do zero a partir do extrato (ver backfill no final)
    r.criado_em ? toIso(r.criado_em) : sqlStr(new Date().toISOString()),
  ]);
  return { cols, values };
}

function transformBoloes(rows) {
  const cols = ['id', 'nome', 'loteria', 'tipo_sorteio', 'concurso', 'data_sorteio',
    'valor_cota_inteira_centavos', 'valor_cota_meia_centavos', 'quantidade_cotas',
    'cotas_disponiveis', 'custo_centavos', 'premio_concurso_centavos', 'premio_ganho_centavos',
    'divisao_lucro', 'promocao_percentual', 'observacao', 'premio_estimado', 'jogos_descricao',
    'status', 'criado_em', 'atualizado_em'];
  const values = rows.map(r => [
    sqlStr(r.id), sqlStr(r.nome), sqlStr(r.loteria), sqlStr(r.tipo_sorteio),
    sqlNum(r.concurso), sqlStr(r.data_sorteio),
    toCentavos(r.valor_cota_inteira), toCentavos(r.valor_cota_meia), sqlNum(r.quantidade_cotas),
    sqlNum(r.cotas_disponiveis), toCentavos(r.custo), toCentavos(r.premio_concurso), toCentavos(r.premio_ganho),
    sqlStr(r.divisao_lucro), sqlNum(r.promocao_percentual), sqlStr(r.observacao), sqlStr(r.premio_estimado), sqlStr(r.jogos_descricao),
    sqlStr(r.status), toIso(r.criado_em), toIso(r.atualizado_em),
  ]);
  return { cols, values };
}

function transformParticipacoes(rows) {
  const cols = ['id', 'bolao_id', 'telefone', 'cotas_meias', 'valor_total_centavos',
    'status_pagamento', 'pago_em', 'criado_em', 'forma_pagamento', 'posicao',
    'valor_saldo_usado_centavos', 'comprovante_enviado_em'];
  const values = rows.map(r => [
    sqlStr(r.id), sqlStr(r.bolao_id), sqlStr(r.telefone), toCotasMeias(r.cotas),
    toCentavos(r.valor_total), sqlStr(r.status_pagamento), toIso(r.pago_em), toIso(r.criado_em),
    sqlStr(r.forma_pagamento || 'pix'), sqlNum(r.posicao), toCentavos(r.valor_saldo_usado || 0),
    toIso(r.comprovante_enviado_em),
  ]);
  return { cols, values };
}

function transformExtrato(rows) {
  const cols = ['id', 'telefone', 'tipo', 'valor_centavos', 'descricao', 'bolao_id', 'criado_em'];
  const values = rows.map(r => [
    sqlStr(r.id), sqlStr(r.telefone), sqlStr(r.tipo), toCentavos(r.valor),
    sqlStr(r.descricao), sqlStr(r.bolao_id), toIso(r.criado_em),
  ]);
  return { cols, values };
}

function transformSaques(rows) {
  const cols = ['id', 'telefone', 'valor_centavos', 'status', 'chave_pix', 'observacao', 'criado_em', 'processado_em'];
  const values = rows.map(r => [
    sqlStr(r.id), sqlStr(r.telefone), toCentavos(r.valor), sqlStr(r.status),
    sqlStr(r.chave_pix), sqlStr(r.observacao), toIso(r.criado_em), toIso(r.processado_em),
  ]);
  return { cols, values };
}

// ---------- main ----------
// D1 tem FK de verdade (o Postgres original só tinha FK lógica em telefone),
// então linhas órfãs (telefone/bolão que não existe mais no cadastro, restos
// de clientes/bolões removidos no passado) quebrariam a importação inteira.
// Descarta essas linhas com aviso, em vez de falhar no meio do import.
const usuariosRows = readTable('usuarios');
const boloesRows = readTable('boloes');
const telefonesValidos = new Set(usuariosRows.map(u => u.telefone));
const boloesValidos = new Set(boloesRows.map(b => b.id));

function descartarOrfaos(nomeTabela, rows, { telefoneCampo = 'telefone', bolaoCampo = null } = {}) {
  return rows.filter(r => {
    if (telefoneCampo && r[telefoneCampo] && !telefonesValidos.has(r[telefoneCampo])) {
      console.error(`Aviso: descartando linha de '${nomeTabela}' (id=${r.id}) — telefone '${r[telefoneCampo]}' não existe em usuarios.`);
      return false;
    }
    if (bolaoCampo && r[bolaoCampo] && r[bolaoCampo] !== 'null' && !boloesValidos.has(r[bolaoCampo])) {
      console.error(`Aviso: descartando linha de '${nomeTabela}' (id=${r.id}) — bolao_id '${r[bolaoCampo]}' não existe em boloes.`);
      return false;
    }
    return true;
  });
}

const tables = {
  usuarios: transformUsuarios(usuariosRows),
  boloes: transformBoloes(boloesRows),
  participacoes: transformParticipacoes(descartarOrfaos('participacoes', readTable('participacoes'), { bolaoCampo: 'bolao_id' })),
  extrato: transformExtrato(descartarOrfaos('extrato', readTable('extrato'), { bolaoCampo: 'bolao_id' })),
  saques: transformSaques(descartarOrfaos('saques', readTable('saques'))),
};

let out = '';
out += '-- Gerado por scripts/migrate-data.mjs — NÃO editar à mão.\n';
out += `-- Fonte: ${path.resolve(inputDir)}\n`;
out += `-- Gerado em: ${new Date().toISOString()}\n\n`;

out += '-- 1) Limpa as tabelas (ordem reversa de FK) para reimport idempotente.\n';
out += 'DELETE FROM saques;\n';
out += 'DELETE FROM extrato;\n';
out += 'DELETE FROM participacoes;\n';
out += 'DELETE FROM boloes;\n';
out += 'DELETE FROM usuarios;\n\n';

out += '-- 2) Reimporta (ordem que respeita as FKs do D1).\n';
out += `-- usuarios: ${tables.usuarios.values.length} linha(s)\n`;
out += insert('usuarios', tables.usuarios.cols, tables.usuarios.values) + '\n';
out += `-- boloes: ${tables.boloes.values.length} linha(s)\n`;
out += insert('boloes', tables.boloes.cols, tables.boloes.values) + '\n';
out += `-- participacoes: ${tables.participacoes.values.length} linha(s)\n`;
out += insert('participacoes', tables.participacoes.cols, tables.participacoes.values) + '\n';
out += `-- extrato: ${tables.extrato.values.length} linha(s)\n`;
out += insert('extrato', tables.extrato.cols, tables.extrato.values) + '\n';
out += `-- saques: ${tables.saques.values.length} linha(s)\n`;
out += insert('saques', tables.saques.cols, tables.saques.values) + '\n';

out += '-- 3) Backfill do saldo: recalcula saldo_centavos de TODOS os clientes\n';
out += '--    a partir do extrato recém-importado (fonte da verdade).\n';
out += `UPDATE usuarios SET saldo_centavos = (
  SELECT COALESCE(SUM(CASE WHEN tipo IN ('credito','premio') THEN valor_centavos ELSE -valor_centavos END), 0)
  FROM extrato WHERE extrato.telefone = usuarios.telefone
);\n`;

process.stdout.write(out);
console.error(
  `\nOK: ${tables.usuarios.values.length} usuarios, ${tables.boloes.values.length} boloes, ` +
  `${tables.participacoes.values.length} participacoes, ${tables.extrato.values.length} extrato, ` +
  `${tables.saques.values.length} saques.`
);

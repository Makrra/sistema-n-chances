// Lógica de negócio que, no app original, vivia no client (index.html).
// Migrada para o servidor para não depender de cache local do browser e
// para dar garantias reais de atomicidade via D1 .batch().
//
// IMPORTANTE sobre D1 .batch(): as statements de um batch rodam em sequência
// dentro de UMA transação — uma statement posterior enxerga o efeito de uma
// anterior DO MESMO batch. Mas as funções abaixo que fazem leitura em JS
// (planDistribuicaoPremio) precisam rodar como uma chamada separada (fora do
// batch) ANTES de montar as statements de escrita — portanto só podem ser
// chamadas depois que a mutação da qual dependem já foi de fato commitada
// (ver o padrão de "duas fases" em routes/participacoes.js).
import { ApiError } from './errors.js';
import { toCentavos, fromCentavos } from './money.js';

export const TELEFONE_ORGANIZADOR = '558499119370';

// Sigla usada no código único do bolão (ex: QN-70750001).
export const SIGLA_LOTERIA = {
  'mega-sena': 'MS',
  'lotofacil': 'LF',
  'quina': 'QN',
  'lotomania': 'LM',
  'dupla-sena': 'DS',
  'timemania': 'TM',
  'outro': 'OT',
};

const LOTERIA_NOME = {
  'mega-sena': 'Mega-Sena',
  'lotofacil': 'Lotofácil',
  'quina': 'Quina',
  'lotomania': 'Lotomania',
  'dupla-sena': 'Dupla Sena',
  'timemania': 'Timemania',
  'outro': 'Sorteio',
};

// Nome de exibição do bolão pra descrições de extrato/prêmio. O campo
// `nome` deixou de ser preenchido no cadastro (bolões agora se identificam
// por loteria+concurso+código) — bolões antigos que ainda têm um nome
// customizado continuam mostrando ele; os novos caem no fallback composto.
export function nomeExibicaoBolao(bolao) {
  if (bolao?.nome) return bolao.nome;
  const loteria = LOTERIA_NOME[bolao?.loteria] || bolao?.loteria || 'Bolão';
  return bolao?.concurso ? `${loteria} #${bolao.concurso}` : loteria;
}

// Código único do bolão: {SIGLA}-{concurso}{sequência de 4 dígitos}. A
// sequência reinicia por combinação loteria+concurso (dois bolões do mesmo
// sorteio, ex. um principal e um extra, ficam 0001/0002). Leitura prévia
// segura: é sempre um bolão NOVO sendo criado, não há mutação prévia nesta
// mesma requisição da qual isso dependa.
export async function gerarCodigoBolao(db, loteria, concurso) {
  const sigla = SIGLA_LOTERIA[loteria] || 'OT';
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM boloes WHERE loteria = ? AND concurso = ?`
  ).bind(loteria, concurso).first();
  const seq = String((row?.n || 0) + 1).padStart(4, '0');
  return `${sigla}-${concurso}${seq}`;
}

export function recomputeSaldoStmt(db, telefone) {
  return db.prepare(`
    UPDATE usuarios SET saldo_centavos = (
      SELECT COALESCE(SUM(CASE WHEN tipo IN ('credito','premio') THEN valor_centavos ELSE -valor_centavos END), 0)
      FROM extrato WHERE extrato.telefone = usuarios.telefone
    ) WHERE telefone = ?
  `).bind(telefone);
}

// Réplica de reconciliarExtratoDebito (index.html): garante que exista (ou
// não) um lançamento 'debito' para (telefone, bolao_id) refletindo o
// status/forma de pagamento atuais. Faz uma leitura prévia (segura: não
// depende de nada que a própria requisição ainda vá escrever) e retorna as
// statements necessárias (0 ou 1) para incluir no batch de escrita.
export async function planReconciliacaoDebito(db, {
  telefone, bolaoId, statusPagamento, formaPagamento, valorTotalCentavos,
  valorSaldoUsadoCentavos = 0, bolaoNome, nowIso, newId,
}) {
  const deveDebitar = statusPagamento === 'pago' && (formaPagamento === 'saldo' || formaPagamento === 'misto');
  const valorDebito = formaPagamento === 'misto' ? valorSaldoUsadoCentavos : valorTotalCentavos;

  const existente = await db.prepare(
    `SELECT id, valor_centavos FROM extrato WHERE telefone=? AND bolao_id=? AND tipo='debito' LIMIT 1`
  ).bind(telefone, bolaoId).first();

  const statements = [];
  if (deveDebitar && valorDebito > 0) {
    if (existente) {
      if (existente.valor_centavos !== valorDebito) {
        statements.push(db.prepare(`UPDATE extrato SET valor_centavos=? WHERE id=?`).bind(valorDebito, existente.id));
      }
    } else {
      statements.push(db.prepare(`
        INSERT INTO extrato (id, telefone, tipo, valor_centavos, descricao, bolao_id, criado_em)
        VALUES (?,?,?,?,?,?,?)
      `).bind(newId(), telefone, 'debito', valorDebito, `Participação bolão ${bolaoNome || bolaoId}`, bolaoId, nowIso()));
    }
  } else if (existente) {
    statements.push(db.prepare(`DELETE FROM extrato WHERE id=?`).bind(existente.id));
  }
  return statements;
}

// Réplica de distribuirPremio (index.html): substitui os lançamentos tipo
// 'premio' do bolão, ratado por um valor FIXO por cota = premioTotal /
// quantidade_cotas do bolão (não pelas cotas só de quem pagou). Quem não
// pagou não recebe nada, e a parte dele fica sem distribuir pra ninguém —
// decisão de negócio confirmada com o usuário (evita inflar o valor por
// cota de quem pagou quando alguém deixa a cota pendente).
//
// CHAMAR SOMENTE depois que qualquer mutação de participacoes desta mesma
// requisição já tiver sido commitada (ver nota no topo do arquivo).
export async function planDistribuicaoPremio(db, { bolaoId, premioTotalCentavos, bolaoNome, bolaoConcurso, quantidadeCotas, newId, nowIso }) {
  const statements = [db.prepare(`DELETE FROM extrato WHERE bolao_id=? AND tipo='premio'`).bind(bolaoId)];
  const telefonesAfetados = new Set();
  if (!premioTotalCentavos || premioTotalCentavos <= 0) return { statements, telefonesAfetados };

  const totalCotasMeiasBolao = (quantidadeCotas || 0) * 2;
  if (totalCotasMeiasBolao <= 0) return { statements, telefonesAfetados };

  const { results: pagantes } = await db.prepare(
    `SELECT telefone, cotas_meias FROM participacoes WHERE bolao_id=? AND status_pagamento='pago'`
  ).bind(bolaoId).all();

  pagantes.forEach((p) => {
    const valor = Math.round(premioTotalCentavos * (p.cotas_meias / totalCotasMeiasBolao));
    if (valor <= 0) return;
    statements.push(db.prepare(`
      INSERT INTO extrato (id, telefone, tipo, valor_centavos, descricao, bolao_id, criado_em)
      VALUES (?,?,?,?,?,?,?)
    `).bind(newId(), p.telefone, 'premio', valor,
      `Prêmio - ${bolaoNome || 'Bolão'} (Concurso #${bolaoConcurso ?? '—'})`, bolaoId, nowIso()));
    telefonesAfetados.add(p.telefone);
  });
  return { statements, telefonesAfetados };
}

// Réplica de resolverPagamentoSaldo (index.html), mas autoritativa no
// servidor: lê o saldo real (não confia no client) e valida o valor que o
// operador escolheu usar do saldo (coletado via prompt no front-end).
export async function resolverSaldo(db, telefone, valorTotalCentavos, desejadoReais) {
  const row = await db.prepare(`SELECT saldo_centavos FROM usuarios WHERE telefone=?`).bind(telefone).first();
  const saldoDisponivel = row?.saldo_centavos ?? 0;
  if (saldoDisponivel <= 0) {
    throw new ApiError(400, `Saldo insuficiente (${fromCentavos(saldoDisponivel)}). Altere para Pix.`);
  }
  if (desejadoReais == null) {
    throw new ApiError(400, 'Informe quanto do saldo usar (valor_saldo_usado_desejado).');
  }
  const desejado = toCentavos(desejadoReais);
  if (desejado < 0 || desejado > saldoDisponivel) {
    throw new ApiError(400, `Valor acima do saldo disponível (${fromCentavos(saldoDisponivel)}).`);
  }
  if (desejado > valorTotalCentavos) {
    throw new ApiError(400, `Valor acima do total da cota (${fromCentavos(valorTotalCentavos)}).`);
  }
  let formaPagamento = 'saldo';
  const valorSaldoUsadoCentavos = desejado;
  if (valorSaldoUsadoCentavos === 0) formaPagamento = 'pix';
  else if (valorSaldoUsadoCentavos < valorTotalCentavos) formaPagamento = 'misto';
  return { formaPagamento, valorSaldoUsadoCentavos };
}

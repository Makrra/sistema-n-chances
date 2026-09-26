#!/usr/bin/env node
// Verifica diariamente quais loterias da Caixa estão acumuladas e envia um
// e-mail de resumo via Resend.
//
// Uso: node scripts/verificar-acumulados.mjs
//
// Variáveis de ambiente esperadas:
//   RESEND_API_KEY   - API key do Resend (https://resend.com)
//   EMAIL_REMETENTE  - endereço remetente (ex: onboarding@resend.dev)
//   EMAIL_DESTINOS   - destinatários separados por vírgula
//
// Fonte dos dados: API pública da Caixa (mesma usada pelo site oficial de
// resultados), um endpoint por modalidade.

const LOTERIAS = [
  { slug: 'megasena', nome: 'Mega-Sena' },
  { slug: 'lotofacil', nome: 'Lotofácil' },
  { slug: 'quina', nome: 'Quina' },
  { slug: 'lotomania', nome: 'Lotomania' },
  { slug: 'duplasena', nome: 'Dupla-Sena' },
  { slug: 'timemania', nome: 'Timemania' },
];

const API_BASE = 'https://servicebus2.caixa.gov.br/portaldeloterias/api';

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatarData(dataStr) {
  // A API retorna datas no formato DD/MM/AAAA já em pt-BR.
  return dataStr || '-';
}

async function consultarLoteria(loteria) {
  const resposta = await fetch(`${API_BASE}/${loteria.slug}`, {
    headers: { Accept: 'application/json' },
  });

  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status} ao consultar ${loteria.nome}`);
  }

  const dados = await resposta.json();

  return {
    ...loteria,
    concurso: dados.numero,
    acumulou: Boolean(dados.acumulado),
    valorEstimadoProximo: dados.valorEstimadoProximoConcurso,
    dataProximoConcurso: dados.dataProximoConcurso,
  };
}

async function coletarResultados() {
  const resultados = await Promise.allSettled(LOTERIAS.map(consultarLoteria));

  const sucesso = [];
  const falhas = [];

  resultados.forEach((resultado, indice) => {
    if (resultado.status === 'fulfilled') {
      sucesso.push(resultado.value);
    } else {
      falhas.push({ loteria: LOTERIAS[indice].nome, erro: resultado.reason.message });
    }
  });

  return { sucesso, falhas };
}

function montarHtml({ sucesso, falhas }) {
  const acumuladas = sucesso.filter((item) => item.acumulou);
  const naoAcumuladas = sucesso.filter((item) => !item.acumulou);
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const linhaAcumulada = (item) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">✅ <strong>${item.nome}</strong> (concurso ${item.concurso})</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${formatarMoeda(item.valorEstimadoProximo)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${formatarData(item.dataProximoConcurso)}</td>
    </tr>`;

  const linhaNaoAcumulada = (item) => `<li>${item.nome} (concurso ${item.concurso}) — não acumulou</li>`;

  const linhaFalha = (item) => `<li>${item.loteria}: ${item.erro}</li>`;

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <h2>🎰 Acumulados de hoje (${hoje})</h2>
    ${
      acumuladas.length
        ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
            <thead>
              <tr style="text-align:left;background:#f5f5f5;">
                <th style="padding:8px 12px;">Loteria</th>
                <th style="padding:8px 12px;">Prêmio estimado</th>
                <th style="padding:8px 12px;">Próximo sorteio</th>
              </tr>
            </thead>
            <tbody>${acumuladas.map(linhaAcumulada).join('')}</tbody>
          </table>`
        : '<p>Nenhuma loteria acumulada hoje.</p>'
    }
    ${
      naoAcumuladas.length
        ? `<p style="color:#666;font-size:14px;">Não acumularam: <ul>${naoAcumuladas.map(linhaNaoAcumulada).join('')}</ul></p>`
        : ''
    }
    ${
      falhas.length
        ? `<p style="color:#c00;font-size:14px;">Falha ao consultar: <ul>${falhas.map(linhaFalha).join('')}</ul></p>`
        : ''
    }
  </div>`;
}

async function enviarEmail(html, temAcumulada) {
  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_REMETENTE || 'onboarding@resend.dev';
  const destinos = (process.env.EMAIL_DESTINOS || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  if (!apiKey) throw new Error('RESEND_API_KEY não definida');
  if (!destinos.length) throw new Error('EMAIL_DESTINOS não definida');

  const assunto = temAcumulada
    ? '🎰 Tem loteria acumulada hoje!'
    : 'Resumo diário — nenhuma acumulada hoje';

  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: remetente,
      to: destinos,
      subject: assunto,
      html,
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`Falha ao enviar e-mail via Resend: ${resposta.status} ${corpo}`);
  }
}

async function main() {
  const resultado = await coletarResultados();
  const html = montarHtml(resultado);
  const temAcumulada = resultado.sucesso.some((item) => item.acumulou);

  await enviarEmail(html, temAcumulada);

  console.log(`E-mail enviado. Acumuladas: ${resultado.sucesso.filter((i) => i.acumulou).length}/${resultado.sucesso.length}.`);
  if (resultado.falhas.length) {
    console.warn('Falhas na consulta:', resultado.falhas);
  }
}

main().catch((erro) => {
  console.error('Erro ao executar verificação de acumulados:', erro);
  process.exit(1);
});

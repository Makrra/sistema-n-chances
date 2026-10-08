// Resumo diário dos prêmios estimados das loterias da Caixa, enviado por
// e-mail (Resend) pelo Cron Trigger do worker. Todo dia chega um e-mail:
// com o assunto de alerta quando alguma loteria passa do valor mínimo, ou
// com aviso de "nenhuma acima do parâmetro" caso contrário (prova de vida).

const LOTERIAS = [
  { slug: 'megasena', nome: 'Mega-Sena', valorMinimo: 50_000_000 },
  { slug: 'lotofacil', nome: 'Lotofácil', valorMinimo: 5_000_000 },
  { slug: 'quina', nome: 'Quina', valorMinimo: 20_000_000 },
  { slug: 'lotomania', nome: 'Lotomania', valorMinimo: 10_000_000 },
  { slug: 'duplasena', nome: 'Dupla-Sena', valorMinimo: 10_000_000 },
];

const API_BASE = 'https://servicebus2.caixa.gov.br/portaldeloterias/api';

const moeda = (valor) =>
  Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function consultarLoteria(loteria) {
  const resposta = await fetch(`${API_BASE}/${loteria.slug}`, {
    headers: { Accept: 'application/json' },
  });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status} ao consultar ${loteria.nome}`);
  const dados = await resposta.json();
  return {
    ...loteria,
    concurso: dados.numero,
    valorEstimadoProximo: Number(dados.valorEstimadoProximoConcurso || 0),
    dataProximoConcurso: dados.dataProximoConcurso || '-',
  };
}

async function coletar() {
  const resultados = await Promise.allSettled(LOTERIAS.map(consultarLoteria));
  const itens = [];
  const falhas = [];
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') itens.push(r.value);
    else falhas.push({ loteria: LOTERIAS[i].nome, erro: r.reason.message });
  });
  return { itens, falhas };
}

function montarHtml({ itens, falhas }) {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const acima = itens.filter((i) => i.valorEstimadoProximo >= i.valorMinimo);

  const td = 'padding:8px 12px;border-bottom:1px solid #eee;';
  const linha = (i) => {
    const bateu = i.valorEstimadoProximo >= i.valorMinimo;
    return `<tr>
      <td style="${td}">${bateu ? '🎉' : '▫️'} <strong>${i.nome}</strong> (concurso ${i.concurso})</td>
      <td style="${td}">${moeda(i.valorEstimadoProximo)}</td>
      <td style="${td}">${i.dataProximoConcurso}</td>
      <td style="${td}color:#666;">mín. ${moeda(i.valorMinimo)}</td>
    </tr>`;
  };

  const titulo = acima.length
    ? `🎰 Prêmios acima do parâmetro hoje (${hoje})`
    : `Nenhuma loteria acima do parâmetro hoje (${hoje})`;

  return `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
    <h2>${titulo}</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr style="text-align:left;background:#f5f5f5;">
          <th style="padding:8px 12px;">Loteria</th>
          <th style="padding:8px 12px;">Prêmio estimado</th>
          <th style="padding:8px 12px;">Próximo sorteio</th>
          <th style="padding:8px 12px;">Parâmetro</th>
        </tr>
      </thead>
      <tbody>${itens.map(linha).join('')}</tbody>
    </table>
    ${
      falhas.length
        ? `<p style="color:#c00;font-size:14px;">Falha ao consultar:</p><ul>${falhas
            .map((f) => `<li>${f.loteria}: ${f.erro}</li>`)
            .join('')}</ul>`
        : ''
    }
  </div>`;
}

async function enviarEmail(env, assunto, html) {
  const destinos = (env.EMAIL_DESTINOS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY não definida');
  if (!destinos.length) throw new Error('EMAIL_DESTINOS não definida');

  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_REMETENTE || 'avisos@nchances.com.br',
      to: destinos,
      subject: assunto,
      html,
    }),
  });
  if (!resposta.ok) {
    throw new Error(`Resend ${resposta.status}: ${await resposta.text()}`);
  }
}

export async function enviarResumoAcumulados(env) {
  const { itens, falhas } = await coletar();
  const acima = itens.filter((i) => i.valorEstimadoProximo >= i.valorMinimo);

  let assunto;
  if (acima.length) assunto = '🎰 Prêmio bom pra bolão hoje!';
  else if (!itens.length) assunto = '⚠️ Falha ao consultar as loterias hoje';
  else assunto = 'Loterias: nenhuma acima do parâmetro hoje';

  await enviarEmail(env, assunto, montarHtml({ itens, falhas }));
  console.log(`Resumo enviado: "${assunto}"`);
  return { assunto, consultadas: itens.length, falhas };
}

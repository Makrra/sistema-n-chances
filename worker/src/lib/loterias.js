// Regras por loteria para a funcionalidade de jogos/estratégia/resultado
// (ver docs/funcionalidade-jogos-resultado-sorteio.md, seção 6.3).
//
// As cores vêm da "Paleta jogos" oficial do Manual de Identidade Visual das
// Loterias CAIXA (Livro da marca v.1, cap. 7, seção 7.2.1) — não são um
// palpite visual. `corTexto` já é o resultado do teste de contraste WCAG AA
// (branco vs. preto) feito contra cada cor de fundo; ver seção 9.3 do
// documento para os números exatos.
//
// Espelhado no front-end público (public/c.html) e no admin (public/index.html)
// como LOTERIAS_CORES, já que essas páginas são bundles estáticos sem import
// compartilhado com o Worker — mesmo padrão de duplicação pequena e
// intencional já usado hoje entre negocio.js:SIGLA_LOTERIA e
// index.html:LOTERIA_LABEL. Qualquer mudança de cor/regra aqui precisa ser
// replicada nos dois HTMLs.
export const LOTERIAS = {
  'mega-sena': {
    nome: 'Mega-Sena', dezenasMin: 6, dezenasMax: 15, faixaMin: 1, faixaMax: 60,
    cor: '#00AB67', corTexto: '#000000',
  },
  'lotofacil': {
    nome: 'Lotofácil', dezenasMin: 15, dezenasMax: 20, faixaMin: 1, faixaMax: 25,
    cor: '#803594', corTexto: '#FFFFFF',
  },
  'quina': {
    nome: 'Quina', dezenasMin: 5, dezenasMax: 15, faixaMin: 1, faixaMax: 80,
    cor: '#005DA4', corTexto: '#FFFFFF',
  },
  'lotomania': {
    nome: 'Lotomania', dezenasMin: 50, dezenasMax: 50, faixaMin: 1, faixaMax: 100,
    cor: '#F99D1C', corTexto: '#000000',
  },
  'dupla-sena': {
    nome: 'Dupla Sena', dezenasMin: 6, dezenasMax: 15, faixaMin: 1, faixaMax: 50,
    cor: '#A62A52', corTexto: '#FFFFFF',
  },
  'timemania': {
    nome: 'Timemania', dezenasMin: 10, dezenasMax: 10, faixaMin: 1, faixaMax: 80,
    cor: '#FFDD00', corTexto: '#000000',
  },
  'outro': {
    nome: 'Sorteio', dezenasMin: null, dezenasMax: null, faixaMin: null, faixaMax: null,
    cor: '#6B7280', corTexto: '#FFFFFF',
  },
};

export function regrasLoteria(loteria) {
  return LOTERIAS[loteria] || LOTERIAS['outro'];
}

// Valida um jogo (array de dezenas já parseado) contra as regras da loteria.
// 'outro' não tem regra automática (regrasLoteria retorna min/max null) —
// aceita qualquer coisa não vazia.
export function validarJogo(loteria, dezenas) {
  if (!Array.isArray(dezenas) || dezenas.length === 0) {
    return { valido: false, erro: 'Jogo vazio.' };
  }
  if (dezenas.some(d => !Number.isInteger(d))) {
    return { valido: false, erro: 'Dezena inválida (use só números inteiros).' };
  }
  if (new Set(dezenas).size !== dezenas.length) {
    return { valido: false, erro: 'Dezena repetida no mesmo jogo.' };
  }
  const regra = regrasLoteria(loteria);
  if (regra.dezenasMin != null && dezenas.length < regra.dezenasMin) {
    return { valido: false, erro: `Mínimo de ${regra.dezenasMin} dezenas para ${regra.nome}.` };
  }
  if (regra.dezenasMax != null && dezenas.length > regra.dezenasMax) {
    return { valido: false, erro: `Máximo de ${regra.dezenasMax} dezenas para ${regra.nome}.` };
  }
  if (regra.faixaMin != null && regra.faixaMax != null) {
    const foraDaFaixa = dezenas.find(d => d < regra.faixaMin || d > regra.faixaMax);
    if (foraDaFaixa != null) {
      return { valido: false, erro: `Dezena ${foraDaFaixa} fora da faixa válida (${regra.faixaMin}–${regra.faixaMax}).` };
    }
  }
  return { valido: true, erro: null };
}

// Parseia uma linha colada em "Inserir jogos" (UC02): números separados por
// espaço, vírgula ou ponto-e-vírgula. Retorna null se a linha não tiver
// nenhum número (linha em branco, pra ser ignorada, não é erro).
export function parseLinhaJogo(linha) {
  const limpa = linha.trim();
  if (!limpa) return null;
  const partes = limpa.split(/[\s,;]+/).filter(Boolean);
  const dezenas = partes.map(p => parseInt(p, 10));
  return dezenas;
}

// Interseção entre as dezenas do jogo e as dezenas sorteadas — não
// persistida, calculada sob demanda (ver seção 5.2 do documento).
export function contarAcertos(dezenasJogo, dezenasSorteadas) {
  if (!Array.isArray(dezenasJogo) || !Array.isArray(dezenasSorteadas)) return 0;
  const sorteadasSet = new Set(dezenasSorteadas);
  return dezenasJogo.filter(d => sorteadasSet.has(d)).length;
}

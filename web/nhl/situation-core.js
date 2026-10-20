// Baseball's situation (balls, strikes, outs, runners) has no hockey
// counterpart. The same exports as web/mlb/situation-core.js, answering
// nothing, so main.js needs no branch: the clock and the score by period are
// in live-core.js.

export const liveSituation = () => null;
export const isBetweenInnings = () => false;
export const situationHtml = () => '';

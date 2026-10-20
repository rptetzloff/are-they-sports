// Baseball's situation (balls, strikes, outs, runners) has no basketball
// counterpart. The same exports as web/mlb/situation-core.js, answering
// nothing, so main.js needs no branch: the clock and the score by quarter are
// in live-core.js.

export const liveSituation = () => null;
export const isBetweenInnings = () => false;
export const situationHtml = () => '';

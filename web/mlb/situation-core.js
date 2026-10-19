// The live game's base-out state: who is on, how many are out, and the count.
// Pure functions — no fetch/DOM — so the drawing can be tested without a game
// in progress, which is most of the year.
//
// The live-score code was carried over from the football site and only ever
// read down-and-distance and possession, which baseball does not have. ESPN's
// MLB payload carries this instead, in two shapes: the scoreboard sends
// onFirst/onSecond/onThird as booleans, the summary endpoint sends an athlete
// object when a base is occupied and leaves the key out when it is not. Both
// reduce to "truthy means somebody is standing there".

const count = (v, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : null;
};

/**
 * Normalize an ESPN `situation` object. Returns null when there is nothing to
 * draw — no situation at all, or one with neither outs nor runner keys, which
 * is what the summary sends before first pitch.
 */
export function liveSituation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const outs = count(raw.outs, 3);
  const hasBases = ['onFirst', 'onSecond', 'onThird'].some(k => k in raw);
  if (outs == null && !hasBases) return null;
  return {
    outs: outs ?? 0,
    balls: count(raw.balls, 4),
    strikes: count(raw.strikes, 3),
    first: !!raw.onFirst,
    second: !!raw.onSecond,
    third: !!raw.onThird,
  };
}

// Between half-innings ESPN's status reads "Middle 4th" / "End 4th" while the
// situation still holds the last at-bat's runners — drawing them would show a
// man on second who has already walked off the field.
export function isBetweenInnings(statusDetail) {
  return /^(middle|end)\b/i.test(String(statusDetail || '').trim());
}

const BASE = (x, y, on) =>
  `<rect x="${x}" y="${y}" width="10" height="10" transform="rotate(45 ${x + 5} ${y + 5})" class="base${on ? ' on' : ''}"/>`;

/**
 * The scorebug: a diamond with occupied bases filled, three out dots, and the
 * count. Returns '' when `sit` is null so callers can append unconditionally.
 */
export function situationHtml(sit) {
  if (!sit) return '';
  const runners = [sit.first && '1st', sit.second && '2nd', sit.third && '3rd'].filter(Boolean);
  const basesLabel = runners.length ? `Runners on ${runners.join(', ')}` : 'Bases empty';
  const outsLabel = `${sit.outs} out${sit.outs === 1 ? '' : 's'}`;
  const hasCount = sit.balls != null && sit.strikes != null;
  const label = [basesLabel, outsLabel, hasCount && `count ${sit.balls}-${sit.strikes}`].filter(Boolean).join(', ');

  // Second at the top, third left, first right — the way the field looks from
  // behind home plate, which is how every broadcast scorebug draws it.
  const diamond =
    `<svg class="situation-bases" viewBox="0 0 40 28" aria-hidden="true">` +
    BASE(15, 2, sit.second) + BASE(3, 14, sit.third) + BASE(27, 14, sit.first) +
    `</svg>`;
  const outs =
    `<span class="situation-outs" aria-hidden="true">` +
    [0, 1, 2].map(i => `<span class="out-dot${i < sit.outs ? ' on' : ''}"></span>`).join('') +
    `</span>`;
  const countText = hasCount ? `<span class="situation-count" aria-hidden="true">${sit.balls}-${sit.strikes}</span>` : '';

  return `<div class="situation" role="img" aria-label="${label}">${diamond}${outs}${countText}</div>`;
}

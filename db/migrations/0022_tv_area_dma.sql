-- The TV market (DMA) a provider's service area is in.
--
-- A CBS or FOX Sunday-afternoon game is regional: each station carries one of
-- the games in its window, chosen by market. The site said every club's CBS
-- game was on the viewer's local CBS. With an area's market known, the page
-- reads that week's coverage maps (lib/coverage.js) for what the market's
-- station actually carries, and which streaming-only games it simulcasts.
-- NULL until the admin sets it; the names are lib/coverage.js DMA_POINTS'.
ALTER TABLE tv_area ADD COLUMN IF NOT EXISTS dma TEXT;

-- Where a service area is on 506sports' coverage maps, for a TV market
-- lib/coverage.js has no calibrated point for.
--
-- The seven markets in DMA_POINTS come calibrated. Any other is placed in the
-- admin page by clicking a posted map, which sets this point in the map's
-- 1280x720 pixels; tv_area.dma then names the market, for matching a
-- streaming game's simulcasts ("WCCB/CW Charlotte"). Nielsen owns the market
-- list and its boundaries, so the repo keeps no list of all 210: a market
-- exists here when someone places it.
ALTER TABLE tv_area ADD COLUMN IF NOT EXISTS map_x INT;
ALTER TABLE tv_area ADD COLUMN IF NOT EXISTS map_y INT;
ALTER TABLE tv_area DROP CONSTRAINT IF EXISTS tv_area_point_on_map;
ALTER TABLE tv_area ADD CONSTRAINT tv_area_point_on_map CHECK (
	(map_x IS NULL AND map_y IS NULL) OR (map_x BETWEEN 4 AND 1275 AND map_y BETWEEN 4 AND 715));

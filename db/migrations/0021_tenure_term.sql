-- A stated tenure's term, as its list writes it.
--
-- The seasons say which games a tenure covers, and they are what the pages
-- count by. They are not how anyone writes a tenure: Doc Rivers was hired by
-- Milwaukee in January 2024, in the season that began in 2023, so his seasons
-- are 2023-24 to 2025-26 and his term is "2024–2026". Written from the seasons,
-- the coaches page said 2023–2026 and he seemed to overlap Adrian Griffin.
-- Empty where the curated file has none (football's).
ALTER TABLE leader_tenure ADD COLUMN IF NOT EXISTS term TEXT NOT NULL DEFAULT '';

-- The Bucks' local TV, MyMilwaukee24, which ESPN lists as 'MyMi'.
--
-- Every Bucks game of 2026-27 names it in ESPN's broadcasts, home and away,
-- and with no network of that name the page printed ESPN's 'MyMi' and could
-- give no provider's channel. Its key is ESPN's name, so a game finds it, and
-- it is the Bucks' (club), as Brewers.TV is the Brewers'. Providers' channel
-- numbers for it are entered in the admin. Left alone if the admin has
-- already added it.
INSERT INTO tv_network (key, club, aliases, display_name, kind, description, website_url, position)
SELECT 'MyMi', 'nba/bucks', '{MyMilwaukee24}'::text[], 'MyMilwaukee24', 'broadcast',
       'Free over-the-air broadcast: the Bucks'' local games', NULL,
       COALESCE((SELECT max(position) + 1 FROM tv_network), 0)
 WHERE NOT EXISTS (SELECT 1 FROM tv_network WHERE key = 'MyMi' AND COALESCE(club, '') IN ('', 'nba/bucks'));

# BirdRoute

Finds places to stop for lifers along a drive. A static page (`docs/`, served by GitHub Pages):
there is no server, and nothing a visitor enters is sent anywhere but the services below.

To use it, a visitor pastes their own free [eBird API key](https://ebird.org/api/keygen) once and
chooses the life-list CSV downloaded from eBird. Both stay in that browser's local storage.

Locally: `npm start`, then <http://localhost:5178>. Tests: `npm test`.

## How it works

- **Life list.** Read in the browser and matched to species codes through eBird's taxonomy. The
  full "My eBird Data" export is also read, but it predates any later splits, so the page says so.
- **Route.** Start and end are geocoded (Nominatim) and routed (OSRM).
- **Sightings.** eBird's recent sightings are swept along the route in overlapping circles that
  cover the chosen corridor. A sweep returns one row per species, so each lifer is then looked up
  on its own to find its other places.
- **Detours** are real driving time: leaving the route up to 12 km before a stop and rejoining up
  to 12 km after, against not stopping.
- **Best value** = lifers, a week-old sighting counting half, per minute of (detour + 20).
- "Open in Google Maps" builds a link with the ticked stops.

"What was left out" under the results counts everything a filter removed.

## Privacy and limits

- The eBird key goes only to eBird. The start and end go to Nominatim, the route and stops to
  OSRM, points along the route to eBird, and map views to OpenStreetMap's tile server.
- The public OSRM, Nominatim and tile servers are for light, non-commercial use. A busy public
  site needs its own or a paid service: see `docs/lib/routing.js`.
- Sightings are from [eBird](https://ebird.org), under its
  [API terms](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/) (non-commercial).

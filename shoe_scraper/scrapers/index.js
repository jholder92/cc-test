export { SportShoesScraper } from "./sportsshoes.js";
export { ProDirectScraper } from "./prodirect.js";
export { StartFitnessScraper } from "./startfitness.js";
export { ZalandoScraper } from "./zalando.js";
export { RunnerInnScraper } from "./runnerinn.js";

import { SportShoesScraper } from "./sportsshoes.js";
import { ProDirectScraper } from "./prodirect.js";
import { StartFitnessScraper } from "./startfitness.js";
import { ZalandoScraper } from "./zalando.js";
import { RunnerInnScraper } from "./runnerinn.js";

/** All scrapers to run each morning */
export const ALL_SCRAPERS = [
  SportShoesScraper,
  ProDirectScraper,
  StartFitnessScraper,
  ZalandoScraper,
  RunnerInnScraper,
];

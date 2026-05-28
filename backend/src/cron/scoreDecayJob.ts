// Cron job to apply score decay to inactive borrowers
// Run this script periodically (e.g., daily) via a scheduler or as part of backend startup

import {
  getInactiveBorrowers,
  applyScoreDecay,
} from "../services/scoreDecayService.js";
import { jobMetricsService } from "../services/jobMetricsService.js";
import logger from "../utils/logger.js";

async function runScoreDecayJob() {
  const startTime = Date.now();
  const jobName = "scoreDecayJob";

  try {
    const borrowers = await getInactiveBorrowers();
    for (const borrower of borrowers) {
      await applyScoreDecay(borrower);
    }
    const durationMs = Date.now() - startTime;
    jobMetricsService.recordSuccess(jobName, durationMs);
    logger.info("Score decay job completed", {
      borrowersProcessed: borrowers.length,
      durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    jobMetricsService.recordFailure(jobName, err as Error | string, durationMs);
    logger.error("Score decay job failed:", { err, durationMs });
  }
}

export default runScoreDecayJob;

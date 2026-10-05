// npm run jobs -- <command>
//   sponsors              refresh the IND recognised-sponsor register
//   discover <person>     LinkedIn search for each target role x location, sponsor-filtered
//   score <person>        triage new jobs, score the top of what survives
//   tailor <jobId>        CV + letter + LinkedIn messages for one job
//   due                   follow-ups due today

import { defaultFetch, discover, tailorOne, triageAndScore } from "../lib/engine.ts";
import { dueFollowUps } from "../lib/followup.ts";
import { listJobs } from "../lib/jobs.ts";
import { refreshSponsors } from "../lib/sponsors.ts";

const [cmd, arg] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case "sponsors":
      console.log(`${await refreshSponsors(defaultFetch)} recognised sponsors saved`);
      break;
    case "discover":
      console.log(await discover(need(arg, "person")));
      break;
    case "score":
      console.log(await triageAndScore(need(arg, "person")));
      break;
    case "tailor": {
      const job = await tailorOne(need(arg, "jobId"));
      console.log(job.error ? `failed: ${job.error}` : `drafted: data/runs/${job.id}/`);
      break;
    }
    case "due":
      for (const j of dueFollowUps(listJobs())) console.log(`${j.followUps![0]}  ${j.personId}  ${j.title} — ${j.company}`);
      break;
    default:
      console.log("commands: sponsors | discover <person> | score <person> | tailor <jobId> | due");
      process.exitCode = 1;
  }
}

function need(v: string | undefined, what: string): string {
  if (!v) throw new Error(`missing <${what}>`);
  return v;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});

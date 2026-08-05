import { outcomeToStatusTone, type Trajectory } from "../../lib/trajectory";
import { StatusPill } from "../../components/Badge";

/**
 * Trajectory outcome chip for the session header band.
 *
 * The viewer itself moved into the workspace dock — see
 * `workspace/dock/panels/TrajectoryPanel.tsx`, which carries the JSON
 * envelope, the download, and the reward read-out that used to live in
 * `TrajectoryRewardChip`. This chip is all that's left in the header,
 * because the header is now shared with the workspace tab strip and only
 * has room for the single most load-bearing signal.
 */
export function TrajectoryOutcomeChip({
  trajectory,
}: {
  trajectory: Trajectory | "loading" | "error" | undefined;
}) {
  if (!trajectory || trajectory === "loading" || trajectory === "error") return null;
  // "running" is intentionally squelched — StatusPill next door already
  // carries the live status, and two pills saying the same thing reads as
  // a rendering bug.
  if (trajectory.outcome === "running") return null;
  return (
    <StatusPill
      status={outcomeToStatusTone(trajectory.outcome)}
      label={`Outcome: ${trajectory.outcome}`}
    />
  );
}

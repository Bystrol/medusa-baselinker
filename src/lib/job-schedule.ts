/**
 * Schedule handling for the plugin's jobs.
 *
 * A job's `config` is read once at load time, so the cron expression cannot
 * come from the plugin options - those are only available through the
 * container, which does not exist yet. Environment variables are the one
 * source available that early.
 *
 * This lives in lib rather than next to the jobs on purpose: Medusa treats
 * every file under src/jobs as a scheduled job and refuses to start the
 * server when one of them exports no config.
 */

/** Values that switch a job off, in addition to an empty string. */
const DISABLED = new Set(["off", "false", "0", "disabled", "none"]);

export const isJobDisabled = (variable: string): boolean => {
  const value = (process.env[variable] ?? "").trim().toLowerCase();
  return DISABLED.has(value);
};

/**
 * A disabled job still needs a valid cron expression, because Medusa parses
 * it at load. It gets a far-future one and returns immediately when it fires.
 */
export const scheduleFromEnv = (variable: string, fallback: string): string => {
  const value = (process.env[variable] ?? "").trim();

  if (!value) return fallback;
  if (DISABLED.has(value.toLowerCase())) return "0 0 1 1 *";

  return value;
};

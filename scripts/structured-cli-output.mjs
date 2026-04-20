export function buildCliErrorPayload(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.stack || error.message : String(error),
  };
}

function serializeCliJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeStdout(payload) {
  return new Promise((resolve, reject) => {
    process.stdout.write(payload, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function printCliJson(value) {
  await writeStdout(serializeCliJson(value));
}

export async function printCliResult(result, { failureExitCode = 1 } = {}) {
  await printCliJson(result);
  if (result?.ok !== true) {
    process.exitCode = failureExitCode;
  }
}

export async function printCliError(error, { failureExitCode = 1 } = {}) {
  await printCliJson(buildCliErrorPayload(error));
  process.exitCode = failureExitCode;
}

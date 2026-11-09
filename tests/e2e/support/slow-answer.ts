/** Delays a fake Canvas response. */
export async function slowAnswer(ms: number): Promise<void> {
  // eslint-disable-next-line test-waits/no-node-sleep -- This delay simulates a slow Canvas and is not a wait.
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

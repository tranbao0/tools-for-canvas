export declare const TEST_ONLY_MARKERS: readonly string[];
/** Return every bundle that contains a test-only marker. */
export declare function findTestOnlyCode(dir: string): Promise<string[]>;

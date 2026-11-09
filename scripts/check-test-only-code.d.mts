export declare const TEST_ONLY_MARKERS: readonly string[];
/** Return every bundle that contains a test-only marker. */
export declare function findTestOnlyCode(dir: string): Promise<string[]>;
/** Return every marker absent from the test build. */
export declare function findMissingTestOnlyMarkers(dir: string): Promise<string[]>;

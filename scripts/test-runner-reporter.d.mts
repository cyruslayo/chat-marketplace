import type { TestEvent } from "node:test/reporters";

export default function testRunnerReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string, void, unknown>;

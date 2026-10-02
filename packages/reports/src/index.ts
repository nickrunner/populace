export { verifyFinding, verifyPending, replayFinding, heuristicJudge, modelJudge, normalizeResult, type VerifierDeps, type ReplayOutcome } from "./verifier.js";
export { clusterFindings, titleTokens, jaccard, primaryTool, type ClusterOptions, type CohortCensus } from "./cluster.js";
export { signatureHistories, type ExecutionFindings, type SignatureHistory, type SignatureState } from "./signatures.js";
export { buildDigest, type DigestOptions } from "./digest.js";
export { renderDigestMarkdown } from "./render.js";
export { MarkdownFileExporter, exporterNamed, exporters, type Exporter, type ExportResult } from "./exporters.js";

/*
 * The typed judge, exported because `verifier.judge: "typesafe"` is otherwise unreachable from
 * outside this package: `VerifierDeps.typesafe` wants a `TypesafeClient`, and nothing that
 * assembles those deps could build one. The KEY stays with whoever reads the environment — a
 * client is a thing that can be asked a question, not a credential to pass around — which is why
 * the factory is exported and `TYPESAFE_API_KEY` appears nowhere in this package.
 */
export {
  createTypesafeClient,
  typesafeJudge,
  buildJudgeRequest,
  composeVerdict,
  TYPESAFE_ENDPOINT,
  JEV_MODEL,
  JEV_INPUT_USD_PER_MTOK,
  STATE_CHAR_BUDGET,
  type TypesafeClient,
  type TypesafeClientOptions,
  type TypesafeFetch,
  type SystemOneRequest,
  type SystemOneResponse,
  type JudgeAnswers,
} from "./typesafe-judge.js";
export { compareSteps, type StepComparison } from "./verifier.js";

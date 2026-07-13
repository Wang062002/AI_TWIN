import { assessResponse } from "../src/response_guard.js";

function assertIncludes(values, expected, label) {
  if (!values.includes(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${values.join(",") || "none"}`);
  }
}

function assertNoRisk(assessment, label) {
  if (assessment.has_risk) {
    throw new Error(`${label}: expected no risk, got ${JSON.stringify(assessment)}`);
  }
}

function main() {
  const identity = assessResponse({
    input: "\u4f60\u5230\u5e95\u662f\u4e0d\u662f\u672c\u4eba",
    reply: "\u662f\u554a"
  });
  assertIncludes(identity.boundary_risks, "identity_not_disclosed", "identity boundary");

  const currentState = assessResponse({
    input: "\u4f60\u73b0\u5728\u5728\u54ea \u6211\u53bb\u627e\u4f60",
    reply: "\u5728\u5bbf\u820d\n\u4f60\u5feb\u6765"
  });
  assertIncludes(currentState.boundary_risks, "unsupported_current_state_or_commitment", "current-state boundary");

  const safeCurrentState = assessResponse({
    input: "\u4f60\u73b0\u5728\u5728\u54ea \u6211\u53bb\u627e\u4f60",
    reply: "\u53ea\u80fd\u5728\u8fd9\u804a"
  });
  assertNoRisk(safeCurrentState, "safe current-state reply");

  const copy = assessResponse({
    input: "\u90a3\u4f9d\u65e7\u96be\u8bf4",
    reply: "\u4f46T1\u5728\u8d25\u8005\u7ec4\u53ef\u80fd\u6253\u97e9\u534e\u770b\u8c01\u8d62",
    retrieved: {
      styles: [
        {
          id: "style_demo",
          target_reply: "\u4f46t1\u5728\u8d25\u8005\u7ec4\u53ef\u80fd\u6253\u97e9\u534e\u770b\u8c01\u8d62"
        }
      ],
      memories: []
    }
  });
  if (!copy.copy_risks.length) {
    throw new Error("copy risk: expected copy_risks");
  }

  console.log("response guard smoke checks ok");
}

main();

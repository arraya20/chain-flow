import { evaluateReadiness, InputValidationError } from "../src/readiness.mjs";

let inputText = "";
for await (const chunk of process.stdin) {
  inputText += chunk;
}

if (!inputText.trim()) {
  console.error("Expected one JSON request on stdin");
  process.exitCode = 1;
} else {
  let input;
  try {
    input = JSON.parse(inputText);
  } catch {
    console.error("Input must be valid JSON");
    process.exitCode = 1;
  }

  if (input !== undefined) {
    try {
      console.log(JSON.stringify(evaluateReadiness(input)));
    } catch (error) {
      if (error instanceof InputValidationError) {
        console.error(error.message);
        process.exitCode = 1;
      } else {
        throw error;
      }
    }
  }
}

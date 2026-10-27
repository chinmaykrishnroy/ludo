import { createApplication, type ApplicationOptions } from "../server/app.js";
import { AdmissionController } from "../server/admission.js";
// Wire and persistence tests control pressure independently of CI host load.
// Production always uses the real sampler; admission regressions inject samples.
export function createTestApplication(options: ApplicationOptions = {}) {
  return createApplication({
    admission: new AdmissionController(),
    ...options,
  });
}

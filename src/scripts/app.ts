import Alpine from "alpinejs";
import { activityView } from "./activity.ts";
import { intakeForm } from "./intake-form.ts";
import { installPreviewFetchMock, isPreviewMockEnabled } from "./preview-mock.ts";
import { registerServiceWorker } from "./sw-register.ts";

if (isPreviewMockEnabled()) {
  installPreviewFetchMock();
}

Alpine.data("intakeForm", intakeForm);
Alpine.data("activityView", activityView);
(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
Alpine.start();

registerServiceWorker();

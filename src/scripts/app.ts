import Alpine from "alpinejs";
import { activityView } from "./activity.ts";
import { intakeForm } from "./intake-form.ts";
import { registerServiceWorker } from "./sw-register.ts";

Alpine.data("intakeForm", intakeForm);
Alpine.data("activityView", activityView);
(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
Alpine.start();

registerServiceWorker();

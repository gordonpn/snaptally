import Alpine from "alpinejs";
import { intakeForm } from "./intake-form.ts";
import { registerServiceWorker } from "./sw-register.ts";

Alpine.data("intakeForm", intakeForm);
(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
Alpine.start();

registerServiceWorker();

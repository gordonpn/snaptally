import Alpine from "alpinejs";
import { intakeForm } from "./intake-form.ts";

Alpine.data("intakeForm", intakeForm);
(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
Alpine.start();

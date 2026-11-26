// The contact form: validate, show errors next to the fields, POST JSON, and show the thanks state
// only after a 2xx answer. With no endpoint configured it sends nothing and says so.
import {
  MESSAGES,
  submitContact,
  validateContact,
  type ContactInput,
  type FieldKey,
} from "../lib/contact";

const FIELDS: FieldKey[] = ["name", "company", "email", "want"];

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const form = el<HTMLFormElement>("cform");
const summary = el<HTMLElement>("c-err");
const thanks = el<HTMLElement>("thanks");
const submit = form?.querySelector<HTMLButtonElement>("button[type=submit]");

function value(id: string): string {
  return (
    el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id)?.value ?? ""
  ).toString();
}

function readForm(): ContactInput {
  return {
    name: value("c-name"),
    company: value("c-company"),
    email: value("c-email"),
    want: value("c-want"),
    budget: value("c-budget"),
    website: value("c-website"),
  };
}

function fieldId(k: FieldKey): string {
  return k === "want" ? "c-want" : `c-${k}`;
}

function showFieldErrors(errors: Partial<Record<FieldKey, string>>): void {
  for (const k of FIELDS) {
    const input = el<HTMLElement>(fieldId(k));
    const msg = el<HTMLElement>(`${fieldId(k)}-err`);
    const text = errors[k];
    if (!input || !msg) continue;
    if (text) {
      msg.textContent = text;
      msg.hidden = false;
      input.setAttribute("aria-invalid", "true");
    } else {
      msg.textContent = "";
      msg.hidden = true;
      input.removeAttribute("aria-invalid");
    }
  }
}

function setSummary(text: string): void {
  if (summary) summary.textContent = text;
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = readForm();
    const v = validateContact(input);
    showFieldErrors(v.errors);
    if (!v.ok) {
      setSummary(v.summary);
      if (v.first) el<HTMLElement>(fieldId(v.first))?.focus();
      return;
    }
    setSummary("");

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Sending...";
    }
    form.setAttribute("aria-busy", "true");
    const outcome = await submitContact(form.dataset.endpoint ?? "", input);
    form.removeAttribute("aria-busy");
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Send enquiry";
    }

    if (outcome === "sent") {
      form.hidden = true;
      thanks?.classList.add("on");
      thanks?.focus();
    } else {
      setSummary(outcome === "not-configured" ? MESSAGES.notConfigured : MESSAGES.failed);
    }
  });
}

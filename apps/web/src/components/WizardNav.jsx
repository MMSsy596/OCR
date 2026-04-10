export function WizardNav({
  wizardSteps,
  wizardStep,
  canGoNext,
  maxUnlockedStep,
  goToStep,
  setWizardStep,
}) {
  return (
    <section className="wizard-nav card">
      <div className="wizard-steps">
        {wizardSteps.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`wizard-step ${wizardStep === step.id ? "active" : ""}`}
            onClick={() => goToStep(step.id)}
          >
            <span>{step.id}</span>
            <strong>{step.title}</strong>
          </button>
        ))}
      </div>
      <div className="wizard-actions">
        <button
          type="button"
          disabled={wizardStep <= 1}
          onClick={() => setWizardStep((s) => Math.max(1, s - 1))}
        >
          Bước trước
        </button>
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => setWizardStep((s) => Math.min(maxUnlockedStep, s + 1))}
        >
          Bước tiếp
        </button>
      </div>
    </section>
  );
}

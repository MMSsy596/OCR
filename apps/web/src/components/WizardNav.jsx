export function WizardNav({ steps, currentStep, maxUnlockedStep, onGoTo }) {
  const renderStep = (step, originalIndex) => {
    const idx      = originalIndex + 1;
    const isDone   = idx < currentStep;
    const isActive = idx === currentStep;
    const isLocked = idx > (maxUnlockedStep ?? 0) + 1;

    const cls = ["wizard-step", isDone ? "done" : "", isActive ? "active" : "", isLocked ? "locked" : ""]
      .filter(Boolean).join(" ");

    return (
      <button
        key={idx}
        className={cls}
        style={{ background: "transparent", border: "none", color: "inherit" }}
        onClick={() => !isLocked && onGoTo(idx)}
        disabled={isLocked}
        title={step.label}
      >
        <span className="wizard-step-num">
          {isDone ? "✓" : idx}
        </span>
        <span className="wizard-step-label">{step.label}</span>
      </button>
    );
  };

  const stepsList = steps || [];
  const middleIndex = Math.ceil(stepsList.length / 2); // Split at step 4
  const leftSteps = stepsList.slice(0, middleIndex);
  const rightSteps = stepsList.slice(middleIndex);

  return (
    <div className="wizard-nav-container" style={{ display: "flex", flex: 1, justifyContent: "space-between", marginRight: 24 }}>
      <div className="wizard-track card" style={{ padding: "8px 12px" }}>
        {leftSteps.map((step, i) => renderStep(step, i))}
      </div>
      <div className="wizard-track card" style={{ padding: "8px 12px" }}>
        {rightSteps.map((step, i) => renderStep(step, i + middleIndex))}
      </div>
    </div>
  );
}

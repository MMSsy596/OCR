export function WizardNav({ steps, currentStep, maxUnlockedStep, onGoTo }) {
  return (
    <div className="wizard-track card">
      {(steps || []).map((step, i) => {
        const idx      = i + 1;
        const isDone   = idx < currentStep;
        const isActive = idx === currentStep;
        // Cho phép đến step tiếp theo của step đang ở (maxUnlockedStep+1)
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
      })}
    </div>
  );
}

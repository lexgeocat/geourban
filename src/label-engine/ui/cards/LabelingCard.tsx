export interface LabelingCardProps {
  title: string;
  buttonLabel: string;
  onClick: () => void;
}

export default function LabelingCard({ title, buttonLabel, onClick }: LabelingCardProps) {
  return (
    <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
        {title}
      </div>
      <button
        onClick={onClick}
        className="cad-icon-btn"
        style={{ width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

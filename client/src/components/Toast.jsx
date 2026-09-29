import React from 'react';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';

export default function Toast({ message, type = 'success', onClose }) {
  if (!message) return null;

  const bgStyles = {
    success: 'rgba(16, 185, 129, 0.95)',
    error: 'rgba(239, 68, 68, 0.95)',
    info: 'rgba(59, 130, 246, 0.95)',
  };

  const Icon = type === 'error' ? AlertTriangle : type === 'info' ? Info : CheckCircle2;

  return (
    <div
      className="toast"
      style={{
        background: bgStyles[type] || bgStyles.success,
      }}
      onClick={onClose}
    >
      <Icon size={16} />
      <span>{message}</span>
    </div>
  );
}

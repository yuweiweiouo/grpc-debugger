import React from "react";

function MethodIcon({ methodType, hasError }) {
  const color = hasError
    ? "var(--error-color, #d93025)"
    : methodType === "server_streaming"
    ? "var(--streaming-color, #1a73e8)"
    : "var(--success-color, #188038)";

  if (methodType === "server_streaming") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 3L6 6L2 9"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6 3L10 6L6 9"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="4" stroke={color} strokeWidth="1.5" />
      {hasError ? (
        <path
          d="M4 4L8 8M8 4L4 8"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M4 6L5.5 7.5L8 4.5"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export default MethodIcon;

import React from "react";

function ProtoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 2C3 1.44772 3.44772 1 4 1H9L13 5V14C13 14.5523 12.5523 15 12 15H4C3.44772 15 3 14.5523 3 14V2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M9 1V5H13" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fontSize="5"
        fill="currentColor"
        fontWeight="bold"
      >
        PB
      </text>
    </svg>
  );
}

export default ProtoIcon;

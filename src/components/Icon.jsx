const paths = {
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18",
  shield: "m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6zM8 12l3 3 5-6",
  users:
    "M15 21v-2a6 6 0 0 0-12 0v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M18 3a4 4 0 0 1 0 8M21 21v-2a6 6 0 0 0-3-5",
  check: "m5 12 4 4L19 6",
  external: "M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7",
  user: "M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  plus: "M12 5v14M5 12h14",
  search: "m21 21-4.5-4.5M19 10a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  orders: "M8 4H5v17h14V4h-3M9 2h6v4H9zM8 11h8M8 15h5",
  chart: "M4 20V10m7 10V4m7 16v-8M2 21h20",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  arrow: "M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5",
  box: "m3 7 9-5 9 5v11l-9 5-9-5zM3 7l9 5 9-5M12 12v11",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2",
  chevron: "m9 5 7 7-7 7",
  camera: "M8 5l2-3h4l2 3h5v15H3V5zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  tool: "m14 6 4 4M5 21l-2-2L14 8a6 6 0 0 1 7-7l-4 4 2 2 4-4a6 6 0 0 1-7 7z",
};
export default function Icon({ name, size = 20, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.orders} />
    </svg>
  );
}

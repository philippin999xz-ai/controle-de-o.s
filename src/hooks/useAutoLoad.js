import { useEffect, useRef } from "react";

// Observa tanto a página quanto contêineres com rolagem própria.
export default function useAutoLoad(enabled, load, dependencies = []) {
  const target = useRef(null);
  useEffect(() => {
    if (!enabled || !target.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) load();
    }, { rootMargin: "120px" });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [enabled, ...dependencies]);
  return target;
}

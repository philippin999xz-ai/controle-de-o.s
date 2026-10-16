import { useEffect, useState } from "react";
export const core = () => window.Core;
export function useAccount() {
  const [, tick] = useState(0);
  const update = () => tick((n) => n + 1);
  useEffect(() => {
    const onStorage = (e) => {
      if (!e.key || ["os_users", "os_cargos", "os_sess"].includes(e.key))
        update();
    };
    const timer = setInterval(update, 30000);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", update);
    };
  }, []);
  const user = core()?.usuario();
  const required = Boolean(core()?.exigeLogin());
  return {
    user,
    required,
    update,
    can: (p) => Boolean(core()?.can(p)),
    logout: () => {
      core()?.logout();
      update();
    },
  };
}

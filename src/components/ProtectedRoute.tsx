import { ReactNode } from "react";

interface ProtectedRouteProps {
  children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  console.log("✅ Ruta protegida deshabilitada temporalmente - Permitiendo acceso");
  return <>{children}</>;
};

export default ProtectedRoute;

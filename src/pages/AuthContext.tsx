import React, { createContext, useState, useContext, ReactNode, useEffect } from "react";

// Типы данных для состояния контекста
interface AuthContextType {
    isAuthenticated: boolean;
    role: string | undefined;
    setIsAuthenticated: React.Dispatch<React.SetStateAction<boolean>>;
    login: (token: string, role: string) => void;
    logout: () => void;
}

// Контекст
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Провайдер контекста
export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [role, setRole] = useState<string | undefined>(undefined);

    // Логика входа
    const login = (token: string, userRole: string) => {
        localStorage.setItem("token", token);
        localStorage.setItem("role", userRole);
        setIsAuthenticated(true);
        setRole(userRole);
    };

    // Логика выхода
    const logout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        setIsAuthenticated(false);
        setRole(undefined);
    };

    // Проверка состояния авторизации при монтировании компонента
    useEffect(() => {
        const token = localStorage.getItem("token");
        const userRole = localStorage.getItem("role");
        
        if (token) {
            setIsAuthenticated(true);
        }
        if (userRole) {
            setRole(userRole);
        }
    }, []);

    return (
        <AuthContext.Provider value={{ isAuthenticated, role, setIsAuthenticated, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

// Хук для использования контекста
export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};

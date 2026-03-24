import React, { createContext, useContext, useState } from 'react';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'starter' | 'professional' | 'enterprise';
}

interface User {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'DATA_ENGINEER' | 'ANALYST' | 'VIEWER';
  avatarInitials: string;
}

interface TenantContextValue {
  tenant: Tenant;
  user: User;
  setTenant: (tenant: Tenant) => void;
}

const defaultTenant: Tenant = {
  id: 'tenant-001',
  name: 'Acme Corp',
  slug: 'acme-corp',
  plan: 'enterprise',
};

const defaultUser: User = {
  id: 'user-001',
  name: 'Ish Montalvo',
  email: 'ish@acme-corp.com',
  role: 'ADMIN',
  avatarInitials: 'IM',
};

const TenantContext = createContext<TenantContextValue>({
  tenant: defaultTenant,
  user: defaultUser,
  setTenant: () => {},
});

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenant] = useState<Tenant>(defaultTenant);

  return (
    <TenantContext.Provider value={{ tenant, user: defaultUser, setTenant }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => useContext(TenantContext);
export const useUser = () => useContext(TenantContext).user;

export default TenantContext;

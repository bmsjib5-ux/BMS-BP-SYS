// useBmsSession.js — React hooks for BMS session lifecycle and SQL queries.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  retrieveBmsSession,
  executeSqlViaApi,
  extractConnectionConfig,
} from '../services/bmsSession';
import { setSessionCookie, removeSessionCookie } from '../utils/sessionStorage';

export function useBmsSession() {
  const [sessionId, setSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [config, setConfig] = useState(null);      // { apiUrl, apiAuthKey }
  const [userInfo, setUserInfo] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  const isConnected = !!(sessionId && config?.apiUrl);

  // Run a session-id through the API and populate state. Returns true on success.
  const connectSession = useCallback(async (id) => {
    if (!id) {
      setError('Session ID is required');
      return false;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const data = await retrieveBmsSession(id);
      if (data?.MessageCode === 500) {
        setError(data?.Message || 'Session expired');
        return false;
      }
      if (data?.MessageCode !== 200) {
        setError(data?.Message || `MessageCode ${data?.MessageCode ?? 'unknown'}`);
        return false;
      }
      const cfg = extractConnectionConfig(data);
      if (!cfg) {
        setError('Session is missing API URL configuration');
        return false;
      }
      setSessionId(id);
      setSessionData(data);
      setConfig(cfg);
      setUserInfo(data?.result?.user_info || null);
      setSessionCookie(id);
      return true;
    } catch (err) {
      setError(err?.message || 'Failed to connect');
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnectSession = useCallback(() => {
    setSessionId(null);
    setSessionData(null);
    setConfig(null);
    setUserInfo(null);
    setError(null);
    removeSessionCookie();
  }, []);

  const refreshSession = useCallback(async () => {
    if (!sessionId) return false;
    return connectSession(sessionId);
  }, [sessionId, connectSession]);

  const executeQuery = useCallback(async (sql) => {
    if (!config?.apiUrl) {
      return { ok: false, status: 0, data: null, message: 'Not connected', raw: null };
    }
    return executeSqlViaApi(sql, config);
  }, [config]);

  return {
    sessionId,
    sessionData,
    config,
    userInfo,
    isConnected,
    isConnecting,
    error,
    connectSession,
    disconnectSession,
    refreshSession,
    executeQuery,
  };
}

// useQuery — manage a single SQL query lifecycle.
// `session` should be the value returned by useBmsSession() (or the context).
export function useQuery(sql, session, autoExecute = false) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const sqlRef = useRef(sql);
  sqlRef.current = sql;

  const execute = useCallback(async (overrideSql) => {
    const finalSql = overrideSql ?? sqlRef.current;
    if (!finalSql) return null;
    if (!session?.isConnected) {
      const msg = 'Not connected';
      setError(msg);
      return { ok: false, message: msg, data: null };
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await session.executeQuery(finalSql);
      if (result.ok) {
        setData(result.data);
      } else {
        setError(result.message || 'Query failed');
      }
      return result;
    } catch (err) {
      setError(err?.message || 'Query failed');
      return { ok: false, message: err?.message, data: null };
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (autoExecute && session?.isConnected && sql) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExecute, session?.isConnected, sql]);

  return { data, isLoading, error, execute, reset };
}

import axios from "axios";

const api = axios.create({
  baseURL: "/api/backend",
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    // Active club for multi-club managers; backend defaults to the first when absent.
    const clubId = localStorage.getItem("active_club_id");
    if (clubId) config.headers["X-Club-Id"] = clubId;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // A 401 on the login request itself means "wrong credentials" — let the login
    // page show its error. Only an EXPIRED session (401 on some other request)
    // should bounce back to /login. Without this guard the redirect reloads the
    // page and wipes the login form's error before the user can read it.
    const isAuthRequest = err.config?.url?.includes("/auth/");
    if (err.response?.status === 401 && !isAuthRequest && typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;

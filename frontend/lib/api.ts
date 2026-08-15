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
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;

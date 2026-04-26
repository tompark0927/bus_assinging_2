import requests

BASE_URL = "http://localhost:4000"
TIMEOUT = 30

def test_get_api_users_with_valid_token():
    login_url = f"{BASE_URL}/api/auth/login"
    users_url = f"{BASE_URL}/api/users"
    credentials = {
        "email": "testuser@example.com",
        "password": "testpassword"
    }
    try:
        # Authenticate to get JWT token
        login_response = requests.post(login_url, json=credentials, timeout=TIMEOUT)
        assert login_response.status_code == 200, f"Login failed with status code {login_response.status_code}"
        login_data = login_response.json()
        token = login_data.get("token") or login_data.get("accessToken") or login_data.get("jwt")
        assert token and isinstance(token, str), "Token not found in login response"

        headers = {
            "Authorization": f"Bearer {token}"
        }
        # Request user profiles
        users_response = requests.get(users_url, headers=headers, timeout=TIMEOUT)
        assert users_response.status_code == 200, f"GET /api/users failed with status code {users_response.status_code}"
        users_data = users_response.json()
        assert isinstance(users_data, list), "Response data is not an array"

    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_api_users_with_valid_token()

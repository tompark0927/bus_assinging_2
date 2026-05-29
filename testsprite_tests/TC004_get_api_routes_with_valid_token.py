import requests

BASE_URL = "http://localhost:4000"
LOGIN_ENDPOINT = "/api/auth/login"
ROUTES_ENDPOINT = "/api/routes"
TIMEOUT = 30

def test_get_api_routes_with_valid_token():
    login_url = BASE_URL + LOGIN_ENDPOINT
    routes_url = BASE_URL + ROUTES_ENDPOINT
    credentials = {
        "email": "testuser",
        "password": "testpass"
    }
    try:
        # Authenticate to get JWT token
        login_response = requests.post(login_url, json=credentials, timeout=TIMEOUT)
        assert login_response.status_code == 200, f"Login failed with status {login_response.status_code}"
        token = login_response.json().get("token")
        assert token, "JWT token not found in login response"
        
        headers = {
            "Authorization": f"Bearer {token}"
        }
        
        # Get the routes with valid token
        routes_response = requests.get(routes_url, headers=headers, timeout=TIMEOUT)
        assert routes_response.status_code == 200, f"Expected status 200 but got {routes_response.status_code}"
        
        routes_data = routes_response.json()
        assert isinstance(routes_data, list), "Routes response is not an array"
        
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_api_routes_with_valid_token()

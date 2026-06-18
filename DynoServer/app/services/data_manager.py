import json

# Data manager for test log persistence
class DataManager:
    
    def __init__(self, path):
        self.file_path = path
        self._data = None  # Cached data from file
        self._last_mtime = 0  # Track file modifications for cache invalidation
        import threading
        self._lock = threading.Lock()  # Protect cache and file operations
        import os
        self._os = os
    # Load data from file
    def _load_data(self):
        try:
            current_mtime = self._os.path.getmtime(self.file_path)
            with self._lock:
                if self._data is None or current_mtime > self._last_mtime:
                    with open(self.file_path, 'r') as f:
                        self._data = json.load(f)
                        self._last_mtime = current_mtime
                return self._data
        except Exception as e:
            print(f"Error loading data: {e}")
            return []

    # Get test log by ID
    def get_log(self, id):
        data = self._load_data()
        log = next((log for log in data if int(log['id']) == id), None)
        return log

    # Delete test log by ID
    def delete_log(self, id):
        data = self._load_data()
        with self._lock:
            new_data = [log for log in data if int(log['id']) != id]
            if len(new_data) == len(data): return False
            if self.save_file(new_data):
                self._data = new_data
                self._last_mtime = self._os.path.getmtime(self.file_path)
                return True
        return False

    # Add new test log entry
    def add_log(self, log):
        try:
            data = self._load_data()
            with self._lock:
                if 'id' not in log:
                    max_id = max(int(entry['id']) for entry in data) if data else 0
                    log['id'] = max_id + 1
                new_data = list(data)
                new_data.append(log)
                if self.save_file(new_data):
                    self._data = new_data
                    self._last_mtime = self._os.path.getmtime(self.file_path)
                    return True
            return False
        except Exception as e:
            print(f"Error adding log: {e}")
            return False

    # List all test logs
    def list_logs(self):
        data = self._load_data()
        return [
            {'id': log['id'], 'name': log['name'], 'comment': log['comment'], 'date': log['date']}
            for log in data
        ]

    # Save file
    def save_file(self, new_json):
        try:
            with open(self.file_path, 'w') as f:
                json.dump(new_json, f, indent=4)
            return True
        except Exception as e:
            print(f"Error saving file: {e}")
            return False
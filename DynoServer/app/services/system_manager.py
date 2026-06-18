# System manager for coordinating services
class SystemManager:
    # Initialize system manager
    def __init__(self):
        self._can_manager = None
        self._config_manager = None

    # Set CAN manager
    def set_can_manager(self, can_manager):
        self._can_manager = can_manager

    # Set config manager
    def set_config_manager(self, config_manager):
        self._config_manager = config_manager

    # Get CAN manager
    def get_can_manager(self):
        return self._can_manager

    # Get config manager
    def get_config_manager(self):
        return self._config_manager
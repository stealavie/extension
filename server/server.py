import os
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename

# --- Configuration ---
# Folder where files will be uploaded
UPLOAD_FOLDER = 'uploads'
# Allowed file extensions (you can customize this for audio types)
ALLOWED_EXTENSIONS = {'wav', 'mp3', 'm4a', 'ogg', 'flac'}

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 # 16 MB max file size

# --- Helper Functions ---

def allowed_file(filename):
    """Checks if the file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def ensure_upload_folder_exists():
    """Creates the upload folder if it doesn't already exist."""
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
        print(f"Created upload folder at: {os.path.abspath(UPLOAD_FOLDER)}")

# --- HTML Template ---

# (HTML Form is removed as requested)

# --- Main Route ---

@app.route("/upload", methods=['POST'])
def index():
    # --- This block handles the file upload ---
    
    # 1. Check if the 'file' part is in the request
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request.'}), 400
    
    file = request.files['file']
    print(f"Received file: {file.filename}")

    # 2. Check if a file was actually selected
    if file.filename == '':
        return jsonify({'error': 'No file selected.'}), 400
    
    # 3. Check if the file type is allowed and save it
    if file and allowed_file(file.filename):
        # Sanitize the filename for security
        filename = secure_filename(file.filename)
        
        # Create the full path to save the file
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        try:
            # Save the file to the 'uploads' folder
            file.save(save_path)
            
            # --- TODO: Add your audio processing logic here ---
            # For example: process_audio(save_path)
            # ---
            
            message = f'File "{filename}" uploaded successfully!'
            print(message)
            return jsonify({'message': message, 'filename': filename}), 201
            
        except Exception as e:
            return jsonify({'error': f'An error occurred while saving: {e}'}), 500
    else:
        message = 'File type not allowed. Please upload one of: ' + ", ".join(ALLOWED_EXTENSIONS)
        return jsonify({'error': message}), 400

    # (GET request handler is removed)

# --- Run the App ---

if __name__ == "__main__":
    ensure_upload_folder_exists() # Create the 'uploads' folder before starting
    # When running in Colab, you might need to use ngrok or a similar tool
    # to expose the app to the internet.
    # For local development, this is fine.
    app.run(debug=True, port=5001)


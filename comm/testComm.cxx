/// \file
/// \ingroup tutorial_http
///  This program creates and fills one and two dimensional histogram
///  Macro used to demonstrate usage of custom HTML page in custom.htm
///  One can use plain JavaScript to assign different actions with HTML buttons
///
/// \macro_code
///
/// \author Sergey Linev


#include <ROOT/RWebWindowsManager.hxx>

class WHandler {
private:
   std::shared_ptr<ROOT::Experimental::RWebWindow>  fWindow;
   unsigned fConnId{0};

public:
   WHandler() {};

   virtual ~WHandler() { printf("Destructor!!!!\n"); }

   void ProcessData(unsigned connid, const std::string &arg)
   {
      if (arg == "CONN_READY") {
         fConnId = connid;
         printf("connection established %u\n", fConnId);
         //fWindow->Send(fConnId, "INITDONE");
         return;
      }

      if (arg == "CONN_CLOSED") {
         printf("connection closed\n");
         fConnId = 0;
         return;
      }

      printf("Get msg %s \n", arg.c_str());

      float arr[100000];
      for (int n=0;n<100000;++n)
         arr[n] = n;

      for (int n=0;n<8;n++) {
         fWindow->Send(fConnId, Form("Message%d",n));
         arr[0] = n;
         fWindow->SendBinary(fConnId, arr, (n%2 == 0) ? sizeof(arr) : 40);
      }
   }

   void popupTest(const std::string &where = "")
   {

      fWindow =  ROOT::Experimental::RWebWindowsManager::Instance()->CreateWindow();

      // this is very important, it defines name of openui5 widget, which
      // will run on the client side
      // fWindow->SetPanelName("TextTest");

      fWindow->SetDefaultPage("file:testComm.html");

      // this is call-back, invoked when message received via websocket
      fWindow->SetDataCallBack([this](unsigned connid, const std::string &arg) { ProcessData(connid, arg); });

      fWindow->SetGeometry(300, 500); // configure predefined geometry

      fWindow->Show(where);
   }

};

WHandler* handler = nullptr;

void testComm()
{
   handler = new WHandler();

   handler->popupTest();
}
